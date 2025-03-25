const QUIZZET_BACKEND_API = "https://quizzet-be.vercel.app/api";
const GOOGLE_TRANSLATE_API = "https://translate.googleapis.com/translate_a/single";
const MAX_TEXT_LENGTH = 4000; // Giới hạn ký tự cho mỗi yêu cầu API
const DETECT_LANGUAGE_LIMIT = 100; // Số ký tự tối đa để phát hiện ngôn ngữ
const MAX_CACHE_SIZE = 50; // Số lượng bản dịch tối đa lưu trong bộ nhớ đệm

// Bộ nhớ đệm lưu trữ các bản dịch đã thực hiện (tối ưu hiệu suất)
const translationCache = new Map();

// Function to detect language from text
async function detectLanguage(text) {
    try {
        // Use only a portion of text for detection to save bandwidth
        const sampleText = text.slice(0, DETECT_LANGUAGE_LIMIT);
        const url = `${GOOGLE_TRANSLATE_API}?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(sampleText)}`;
        const response = await fetch(url);
        const data = await response.json();
        return data && data[2] ? data[2] : "auto";
    } catch (error) {
        console.error("Language detection error:", error);
        return "auto"; // Default fallback
    }
}

function OptimizedPrompt(text, target_language) {
    return (optimizedPrompt = `
    Bạn là một chuyên gia ngôn ngữ có khả năng tạo flashcard chất lượng cao. Hãy tạo flashcard cho từ "${text}" với ngôn ngữ ${target_language}.
    
    Yêu cầu:
    1. Phải cung cấp thông tin chính xác và đầy đủ
    2. Ví dụ phải thực tế và dễ hiểu
    3. Ghi chú phải hữu ích cho việc ghi nhớ
    4. Định dạng JSON phải chính xác
    
    Trả về kết quả theo cấu trúc JSON sau và KHÔNG kèm theo bất kỳ giải thích nào:
    
    {
    "title": "", // Từ gốc bằng tiếng ${target_language} (không ghi phiên âm)
    "define": "", // Định nghĩa bằng tiếng Việt, ngắn gọn và dễ hiểu
    "type_of_word": "", // Loại từ (danh từ, động từ, tính từ, etc.)
    "transcription": "", // Phiên âm chuẩn theo từng ngôn ngữ
    "example": [
        {
        "en": "", // Câu ví dụ bằng ${target_language}
        "trans": "",// phiên âm theo ví dụ
        "vi": ""  // Dịch nghĩa tiếng Việt
        },
        {
        "en": "",
        "trans": "",
        "vi": ""
        },
        {
        "en": "",
        "trans": "",
        "vi": ""
        },
        {
        "en": "",
        "trans": "",
        "vi": ""
        }
    ],
    "note": "" // Tips ghi nhớ, cách dùng đặc biệt, hoặc các lưu ý quan trọng bằng tiếng Việt. Các dấu nháy đôi "" thay bằng dấu ngoặc () để tránh lỗi JSON
    }
    `);
}

// Function to chunk large text for multiple translation requests
function chunkText(text, maxLength = MAX_TEXT_LENGTH) {
    const chunks = [];
    let index = 0;

    while (index < text.length) {
        // Find a good breaking point (sentence or paragraph)
        let endIndex = Math.min(index + maxLength, text.length);
        if (endIndex < text.length) {
            // Try to break at sentence endings
            const possibleBreaks = [". ", "! ", "? ", "\n\n", "\r\n\r\n"];
            let bestBreak = endIndex;

            for (const breakChar of possibleBreaks) {
                const breakPos = text.lastIndexOf(breakChar, endIndex);
                if (breakPos > index && breakPos < bestBreak) {
                    bestBreak = breakPos + breakChar.length;
                }
            }
            endIndex = bestBreak;
        }

        chunks.push(text.substring(index, endIndex));
        index = endIndex;
    }

    return chunks;
}

// Manage cache size
function addToCache(cacheKey, value) {
    // If cache is full, remove oldest entry
    if (translationCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = translationCache.keys().next().value;
        translationCache.delete(oldestKey);
    }
    translationCache.set(cacheKey, value);
}

async function translateText(text, targetLanguage, sourceLanguage = "auto") {
    // Nếu không có text, trả về rỗng
    if (!text.trim())
        return {
            mainTranslation: "",
            translationsByType: {},
        };

    // Auto-detect source language if not specified
    if (sourceLanguage === "auto" && text.length > 20) {
        sourceLanguage = await detectLanguage(text);
    }

    const cacheKey = `${text.substring(0, 50)}-${sourceLanguage}-${targetLanguage}`;
    if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
    }

    // For large text, split into chunks and translate separately
    if (text.length > MAX_TEXT_LENGTH) {
        try {
            const chunks = chunkText(text);
            const translations = await Promise.all(chunks.map((chunk) => translateChunk(chunk, targetLanguage, sourceLanguage)));

            // Combine main translations
            const mainTranslation = translations.map((t) => t.mainTranslation).join("");

            // Use translations by type from the first chunk only (since alternatives for long text don't make much sense)
            const translationsByType = translations[0].translationsByType || {};

            const result = {
                mainTranslation,
                translationsByType,
            };

            addToCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error("Chunk translation error:", error);
            return {
                mainTranslation: "Lỗi dịch thuật văn bản dài: " + error.message,
                translationsByType: {},
            };
        }
    } else {
        // For smaller text, just translate directly
        try {
            const result = await translateChunk(text, targetLanguage, sourceLanguage);
            addToCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error("Translation error:", error);
            return {
                mainTranslation: "Lỗi dịch thuật: " + error.message,
                translationsByType: {},
            };
        }
    }
}

async function translateChunk(text, targetLanguage, sourceLanguage) {
    try {
        const url = `${GOOGLE_TRANSLATE_API}?client=gtx&sl=${sourceLanguage}&tl=${targetLanguage}&dt=t&dt=bd&dt=at&dt=md&dt=rm&dt=ss&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (!response.ok) {
            console.error("API response not OK:", response.status, response.statusText);
            throw new Error(`API không phản hồi: ${response.status}`);
        }

        const data = await response.json();

        if (!data || !data[0]) {
            console.error("Invalid data structure:", data);
            throw new Error("Dữ liệu trả về không hợp lệ");
        }

        const translatedText = data[0]
            .filter((item) => item && item[0])
            .map((item) => item[0])
            .join("");

        // Extract alternative translations by part of speech
        const translationsByType = {};

        // Alternative translations are in data[1]
        if (data[1] && Array.isArray(data[1])) {
            data[1].forEach((wordGroup) => {
                // wordGroup[0] contains the original word/phrase
                // wordGroup[1] contains the part of speech (noun, verb, etc.)
                // wordGroup[2] contains the array of translations for this part of speech

                if (wordGroup && wordGroup[1] && wordGroup[2] && Array.isArray(wordGroup[2])) {
                    const partOfSpeech = wordGroup[1];

                    // Initialize array for this part of speech if it doesn't exist
                    if (!translationsByType[partOfSpeech]) {
                        translationsByType[partOfSpeech] = [];
                    }

                    // Add translations for this part of speech
                    wordGroup[2].forEach((alt) => {
                        if (alt && alt[0]) {
                            translationsByType[partOfSpeech].push(alt[0]);
                        }
                    });

                    // Limit to 5 translations per part of speech
                    if (translationsByType[partOfSpeech].length > 5) {
                        translationsByType[partOfSpeech] = translationsByType[partOfSpeech].slice(0, 5);
                    }
                }
            });
        }

        return {
            mainTranslation: translatedText,
            translationsByType: translationsByType,
        };
    } catch (error) {
        console.error("Lỗi khi dịch:", error);
        return {
            mainTranslation: "Lỗi dịch thuật: " + error.message,
            translationsByType: {},
        };
    }
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        const { text, targetLanguage = "vi", sourceLanguage = "auto" } = request;

        translateText(text, targetLanguage, sourceLanguage)
            .then((translationResult) => {
                // Create a structured response with main translation and categorized alternatives
                const matches = [{ translation: translationResult.mainTranslation }];

                // Add categorized translations
                for (const [partOfSpeech, translations] of Object.entries(translationResult.translationsByType)) {
                    matches.push({
                        partOfSpeech: translations.join(", "),
                    });
                }

                const result = {
                    translation: {
                        matches: matches,
                    },
                };
                sendResponse(result);
            })
            .catch((error) => {
                console.error("Translation error:", error);
                sendResponse({ error: error.message });
            });

        return true; // Indicates async response
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "save-translation") {
        chrome.storage.local.get(["token", "list_flashcard_id", "target_language"], (result) => {
            const optimizedPrompt = OptimizedPrompt(request.text, result.target_language);
            fetch(`${QUIZZET_BACKEND_API}/flashcards/create-ai`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${result.token}`,
                },
                body: JSON.stringify({ prompt: optimizedPrompt, list_flashcard_id: result.list_flashcard_id }),
            })
                .then((response) => response.json())
                .then((data) => {
                    chrome.storage.local.get(["translation"], (result) => {
                        const translation = result.translation || [];
                        translation.push(request.text);
                        chrome.storage.local.set({ translation });
                    });
                    sendResponse(data);
                })
                .catch((error) => {
                    console.error("Save translation error:", error);
                });
        });
        // lưu translation thành dạng mảng

        return true;
    }
});

// Replace the three cookie.get calls with this function
const tokenSources = [
    // { url: "http://localhost:3000", name: "token", storeLocally: true },
    // { url: "https://www.trongan.site/", name: "token" },
    { url: "https://www.quizzet.site/", name: "token" },
];

function fetchTokens() {
    tokenSources.forEach((source) => {
        chrome.cookies.get({ url: source.url, name: source.name }, (cookie) => {
            const identifier = new URL(source.url).hostname;
            console.log(`Token ${identifier}:`, cookie.value);

            // Only store the localhost token in local storage
            chrome.storage.local.set({ token: cookie.value });
        });
    });
}

// Call the function to fetch tokens
fetchTokens();

function checkUpdate() {
    fetch("https://raw.githubusercontent.com/angutboiz/translate-quizzet-extension/refs/heads/main/data/version.json")
        .then((response) => response.json())
        .then((data) => {
            const currentVersion = chrome.runtime.getManifest().version;

            if (data.version > currentVersion) {
                chrome.storage.local.get(["update_notified"], (result) => {
                    if (!result.update_notified) {
                        chrome.storage.local.set({ update_notified: true });

                        // Hiển thị thông báo toast
                        chrome.notifications.create("update_notification", {
                            type: "basic",
                            iconUrl: "assets/icons.png",
                            title: "Cập nhật mới!",
                            message: `Phiên bản mới (${data.version}) đã có sẵn. Nhấp vào đây để cập nhật.`,
                            priority: 2,
                        });

                        // Mở trang cập nhật khi người dùng bấm vào thông báo
                        chrome.notifications.onClicked.addListener((notificationId) => {
                            if (notificationId === "update_notification") {
                                chrome.tabs.create({ url: "https://github.com/angutboiz/translate-quizzet-extension" });
                            }
                        });
                    }
                });
            }
        })
        .catch(() => {}); // Bỏ qua lỗi
}

async function fetchProfile() {
    chrome.storage.local.get(["token"], (result) => {
        fetch(`${QUIZZET_BACKEND_API}/profile`, {
            headers: {
                Authorization: `Bearer ${result.token}`,
            },
        })
            .then((response) => response.json())
            .then((data) => {
                chrome.storage.local.set({ profile: data.user });
            })
            .catch((error) => {
                console.error("Profile fetch error:", error);
            });
    });
}

async function fetchFlashcard() {
    chrome.storage.local.get(["token"], (result) => {
        fetch(`${QUIZZET_BACKEND_API}/list-flashcards`, {
            headers: {
                Authorization: `Bearer ${result.token}`,
            },
        })
            .then((response) => response.json())
            .then((data) => {
                chrome.storage.local.set({ listFlashCards: data.listFlashCards });
            })
            .catch((error) => {
                console.error("Profile fetch error:", error);
            });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "refresh") {
        fetchProfile();
        fetchFlashcard();
        sendResponse({ ok: true });
    }
});

// Kiểm tra khi extension khởi động hoặc cài đặt
chrome.runtime.onStartup.addListener(checkUpdate);
chrome.runtime.onInstalled.addListener(fetchProfile);
chrome.runtime.onInstalled.addListener(fetchFlashcard);
