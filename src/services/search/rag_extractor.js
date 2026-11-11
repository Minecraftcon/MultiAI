/**
 * services/search/rag_extractor.js
 * =================================
 * Lightweight In-Memory Heuristic RAG Extractor.
 * Chunks fetched web pages and scores them with BM25 + phrase matching.
 * Requires ZERO AI/LLM models, zero embeddings, runs in ~5ms.
 */

const STOP_WORDS = new Set([
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
    "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
    "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
    "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
    "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is",
    "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
    "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves",
    "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
    "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there",
    "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through", "to",
    "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
    "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while", "who", "who's", "whom",
    "why", "why's", "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours"
]);

const BOILERPLATE_PATTERNS = [
    /cookie\s*policy/i,
    /terms\s*of\s*service/i,
    /privacy\s*policy/i,
    /all\s*rights\s*reserved/i,
    /subscribe\s*to\s*our\s*newsletter/i,
    /accept\s*all\s*cookies/i,
    /sign\s*in\s*to\s*your\s*account/i,
    /javascript\s*is\s*disabled/i,
    /please\s*enable\s*cookies/i
];

/**
 * Tokenize string into meaningful lowercase words (filtering stop words).
 */
function tokenize(text) {
    if (!text || typeof text !== "string") return [];
    const words = text.toLowerCase().match(/[a-z0-9_#+.-]+/g) || [];
    return words.filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Chunks a page into semantic sections / paragraphs.
 */
function chunkDocument(text, minLen = 120, maxLen = 1200) {
    if (!text || typeof text !== "string") return [];
    
    // Split by Markdown headers (# Heading) or multi-newlines
    const rawParagraphs = text.split(/(?=\n#{1,4}\s)|\n\n+/g);
    const chunks = [];
    let current = "";

    for (const raw of rawParagraphs) {
        const clean = raw.trim();
        if (!clean) continue;

        // Skip obvious boilerplate lines
        if (BOILERPLATE_PATTERNS.some(p => p.test(clean))) continue;

        if (clean.length < minLen) {
            current = current ? `${current}\n\n${clean}` : clean;
            if (current.length >= minLen) {
                chunks.push(current);
                current = "";
            }
        } else if (clean.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = "";
            }
            // Split oversized paragraph by sentence or line
            const lines = clean.split(/(?<=[.?!])\s+|\n/g);
            let sub = "";
            for (const line of lines) {
                if ((sub + " " + line).length > maxLen && sub.length >= minLen) {
                    chunks.push(sub.trim());
                    sub = line;
                } else {
                    sub = sub ? `${sub} ${line}` : line;
                }
            }
            if (sub.trim().length >= minLen) {
                chunks.push(sub.trim());
            }
        } else {
            if (current) {
                chunks.push(current);
                current = "";
            }
            chunks.push(clean);
        }
    }

    if (current && current.length >= 60) {
        chunks.push(current);
    }

    return chunks;
}

/**
 * Score candidate chunks using Okapi BM25 with exact-phrase & code bonus.
 */
function scoreChunks(query, chunksWithMeta, options = {}) {
    const k1 = options.k1 || 1.2;
    const b = options.b || 0.75;
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0 || chunksWithMeta.length === 0) {
        return [];
    }

    const N = chunksWithMeta.length;
    let totalLength = 0;
    const chunkTokensList = [];
    const docFreq = {};

    // 1. Build document frequencies
    for (const item of chunksWithMeta) {
        const tokens = tokenize(item.text);
        chunkTokensList.push(tokens);
        totalLength += tokens.length;

        const uniqueInDoc = new Set(tokens);
        for (const token of uniqueInDoc) {
            docFreq[token] = (docFreq[token] || 0) + 1;
        }
    }

    const avgdl = totalLength / N || 1;
    const cleanQuery = query.toLowerCase().trim();

    // 2. Score each chunk
    const scored = [];
    for (let i = 0; i < N; i++) {
        const item = chunksWithMeta[i];
        const tokens = chunkTokensList[i];
        const docLen = tokens.length;

        // Term frequency map for doc
        const tfMap = {};
        for (const t of tokens) {
            tfMap[t] = (tfMap[t] || 0) + 1;
        }

        let bm25Score = 0;
        let matchedTerms = 0;

        for (const qt of queryTokens) {
            const tf = tfMap[qt] || 0;
            if (tf > 0) {
                matchedTerms++;
                const n_t = docFreq[qt] || 1;
                // Standard BM25 IDF
                const idf = Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5));
                const numerator = tf * (k1 + 1);
                const denominator = tf + k1 * (1 - b + b * (docLen / avgdl));
                bm25Score += idf * (numerator / denominator);
            }
        }

        if (bm25Score <= 0) continue;

        // Bonus: Exact phrase match of full query or sub-phrases
        const lowerText = item.text.toLowerCase();
        if (cleanQuery.length > 5 && lowerText.includes(cleanQuery)) {
            bm25Score *= 2.0;
        } else {
            // Partial 2-word phrase matches
            const queryWords = cleanQuery.split(/\s+/);
            if (queryWords.length >= 2) {
                for (let w = 0; w < queryWords.length - 1; w++) {
                    const bigram = `${queryWords[w]} ${queryWords[w + 1]}`;
                    if (lowerText.includes(bigram)) {
                        bm25Score *= 1.25;
                        break;
                    }
                }
            }
        }

        // Bonus: Code block or technical declaration
        if (/```|class\s+\w+|def\s+\w+|function\s+\w+|const\s+\w+\s*=/i.test(item.text)) {
            bm25Score *= 1.15;
        }

        // Penalty for chunks with very few matched query terms
        const coverageRatio = matchedTerms / queryTokens.length;
        bm25Score *= (0.5 + 0.5 * coverageRatio);

        scored.push({
            ...item,
            score: bm25Score
        });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Main entry point: extracts top RAG passages from a set of fetched web pages.
 * @param {string} query - The search query.
 * @param {Array<{url: string, title: string, content: string}>} pages - Fetched pages.
 * @param {Object} options - { maxExcerpts, maxPerSource }
 * @returns {Array<{source: string, url: string, text: string, score: number}>}
 */
function extractRagPassages(query, pages = [], options = {}) {
    const maxExcerpts = options.maxExcerpts || 4;
    const maxPerSource = options.maxPerSource || 2;

    const allChunks = [];

    for (const page of pages) {
        if (!page || !page.content) continue;
        const pageChunks = chunkDocument(page.content);
        for (const chunk of pageChunks) {
            allChunks.push({
                source: page.title || "Web Source",
                url: page.url,
                text: chunk
            });
        }
    }

    const scored = scoreChunks(query, allChunks, options);

    // Apply source diversity (max K excerpts per URL)
    const selected = [];
    const sourceCount = {};

    for (const item of scored) {
        const count = sourceCount[item.url] || 0;
        if (count >= maxPerSource) continue;

        sourceCount[item.url] = count + 1;
        selected.push({
            source: item.source,
            url: item.url,
            text: item.text,
            score: Number(item.score.toFixed(2))
        });

        if (selected.length >= maxExcerpts) break;
    }

    return selected;
}

module.exports = {
    tokenize,
    chunkDocument,
    scoreChunks,
    extractRagPassages
};
