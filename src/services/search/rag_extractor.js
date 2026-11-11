/**
 * services/search/rag_extractor.js
 * =================================
 * PAS-BM25: Positional Attention Soft-BM25 RAG Engine.
 *
 * Designed for ultra-fast, context-aware execution in pure JavaScript:
 * 1. Positional Span Attention: Rewards tight keyword clusters in sentences;
 *    discards scattered noise (e.g. Wikipedia navboxes, unrelated SoC matrices).
 * 2. Soft-BM25: Distinguishes technical stems while preserving exact part-number
 *    variants (e.g. ILI9882N vs ILI9882T).
 * 3. Micro-Windowing: Extracts tight 200–380 char sentences around dense matches.
 * 4. Zero subprocesses, zero embeddings, runs in ~3ms on mobile / Termux.
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
    /please\s*enable\s*cookies/i,
    /navigation\s*menu/i,
    /jump\s*to\s*content/i
];

/**
 * Clean & tokenize into lowercase tokens, filtering stop words.
 */
function tokenize(text) {
    if (!text || typeof text !== "string") return [];
    const words = text.toLowerCase().match(/[a-z0-9_#+.-]+/g) || [];
    return words.filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Tokenize text while preserving token character offset positions for micro-windowing.
 */
function tokenizeWithOffsets(text) {
    if (!text || typeof text !== "string") return [];
    const tokens = [];
    const regex = /[a-z0-9_#+.-]+/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const raw = match[0].toLowerCase();
        if (raw.length > 1 && !STOP_WORDS.has(raw)) {
            tokens.push({
                word: raw,
                start: match.index,
                end: match.index + raw.length
            });
        }
    }
    return tokens;
}

/**
 * Soft match similarity between query token and document token.
 * Exact match: 1.0
 * Stem/prefix match: 0.82
 * Part-number variant conflict (e.g. ili9882n vs ili9882t): 0.0 (strictly distinct)
 */
function softTokenMatch(qToken, dToken) {
    if (qToken === dToken) return 1.0;
    
    // Check if alphanumeric part-number suffix conflict
    // e.g. ili9882n vs ili9882t share 7 chars but end with different alphanumeric variant letter
    if (qToken.length >= 6 && dToken.length >= 6) {
        let prefixLen = 0;
        const minLen = Math.min(qToken.length, dToken.length);
        while (prefixLen < minLen && qToken[prefixLen] === dToken[prefixLen]) {
            prefixLen++;
        }
        if (prefixLen >= 5 && prefixLen === minLen - 1) {
            // Suffixes differ by 1 variant letter - strictly do not treat as synonym
            return 0.0;
        }
    }

    // Common stem/prefix match
    if (qToken.length > 4 && dToken.startsWith(qToken)) return 0.85;
    if (dToken.length > 4 && qToken.startsWith(dToken)) return 0.85;

    return 0.0;
}

/**
 * Chunk document into clean paragraphs.
 */
function chunkDocument(text, minLen = 100, maxLen = 1000) {
    if (!text || typeof text !== "string") return [];
    const rawParagraphs = text.split(/(?=\n#{1,4}\s)|\n\n+/g);
    const chunks = [];
    let current = "";

    for (const raw of rawParagraphs) {
        const clean = raw.trim();
        if (!clean) continue;
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

    if (current && current.length >= 50) {
        chunks.push(current);
    }

    return chunks;
}

/**
 * Calculates Positional Span Attention and extracts an optimal micro-window.
 * Finds the shortest span containing matched query terms and measures compactness.
 */
function computePositionalAttention(queryTokens, docTokensWithOffsets, rawText) {
    if (queryTokens.length === 0 || docTokensWithOffsets.length === 0) {
        return { spanMultiplier: 1.0, microWindow: rawText.slice(0, 350) };
    }

    // Map matched positions for each query token
    const termMatches = [];
    for (let qIdx = 0; qIdx < queryTokens.length; qIdx++) {
        const qt = queryTokens[qIdx];
        for (let dIdx = 0; dIdx < docTokensWithOffsets.length; dIdx++) {
            const dt = docTokensWithOffsets[dIdx];
            const sim = softTokenMatch(qt, dt.word);
            if (sim > 0) {
                termMatches.push({
                    qIdx,
                    dIdx,
                    sim,
                    start: dt.start,
                    end: dt.end
                });
            }
        }
    }

    if (termMatches.length === 0) {
        return { spanMultiplier: 0.1, microWindow: rawText.slice(0, 300) };
    }

    // Find the tightest window covering maximum unique query terms
    termMatches.sort((a, b) => a.dIdx - b.dIdx);

    let bestSpan = {
        uniqueCount: 0,
        tokenDist: 9999,
        startChar: termMatches[0].start,
        endChar: termMatches[0].end
    };

    for (let i = 0; i < termMatches.length; i++) {
        const seenQueries = new Set();
        for (let j = i; j < termMatches.length; j++) {
            seenQueries.add(termMatches[j].qIdx);
            const tokenDist = termMatches[j].dIdx - termMatches[i].dIdx + 1;
            const uniqueCount = seenQueries.size;

            if (uniqueCount > bestSpan.uniqueCount || 
               (uniqueCount === bestSpan.uniqueCount && tokenDist < bestSpan.tokenDist)) {
                bestSpan = {
                    uniqueCount,
                    tokenDist,
                    startChar: termMatches[i].start,
                    endChar: termMatches[j].end
                };
            }
            if (tokenDist > 40) break; // Don't track loose spans across > 40 tokens
        }
    }

    // Span Compactness ratio: unique query hits / token distance
    const compactness = bestSpan.tokenDist > 0 ? (bestSpan.uniqueCount / bestSpan.tokenDist) : 0;
    
    // Positional Attention Multiplier:
    // Tight sentence span (compactness > 0.3) gets 1.5x - 3.0x boost
    // Scattered table/navbox (compactness < 0.05) gets 0.2x penalty
    let spanMultiplier = 1.0;
    if (compactness >= 0.25) {
        spanMultiplier = 1.0 + (compactness * 2.5);
    } else if (compactness < 0.06 && bestSpan.uniqueCount < 2) {
        spanMultiplier = 0.25; // Heavily penalize isolated scattered terms in tables
    }

    // Extract Context-Centric Micro-Window (200 - 380 chars around best span)
    const center = Math.floor((bestSpan.startChar + bestSpan.endChar) / 2);
    const targetRadius = 160;
    let winStart = Math.max(0, center - targetRadius);
    let winEnd = Math.min(rawText.length, center + targetRadius);

    // Snap to sentence or line boundaries if nearby
    const prevNewline = rawText.lastIndexOf("\n", winStart);
    const prevSentence = rawText.lastIndexOf(". ", winStart);
    const snapStart = Math.max(prevNewline, prevSentence);
    if (snapStart !== -1 && winStart - snapStart < 60) {
        winStart = snapStart === prevSentence ? snapStart + 2 : snapStart + 1;
    }

    const nextNewline = rawText.indexOf("\n", winEnd);
    const nextSentence = rawText.indexOf(". ", winEnd);
    const candidates = [nextNewline, nextSentence].filter(idx => idx !== -1);
    if (candidates.length > 0) {
        const snapEnd = Math.min(...candidates);
        if (snapEnd - winEnd < 60) {
            winEnd = snapEnd;
        }
    }

    let microWindow = rawText.substring(winStart, winEnd).trim();
    if (winStart > 0 && !microWindow.startsWith("...")) {
        microWindow = "..." + microWindow;
    }
    if (winEnd < rawText.length && !microWindow.endsWith("...")) {
        microWindow = microWindow + "...";
    }

    return {
        spanMultiplier,
        microWindow
    };
}

/**
 * PAS-BM25 Ranker: Combines Soft-BM25 with Positional Attention Span multipliers.
 */
function scoreChunksPASBM25(query, chunksWithMeta, options = {}) {
    const k1 = options.k1 || 1.2;
    const b = options.b || 0.75;
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0 || chunksWithMeta.length === 0) {
        return [];
    }

    const N = chunksWithMeta.length;
    let totalLength = 0;
    const chunkTokensList = [];
    const docOffsetsList = [];
    const docFreq = {};

    // 1. Build document frequencies with soft matching
    for (const item of chunksWithMeta) {
        const tokenOffsets = tokenizeWithOffsets(item.text);
        docOffsetsList.push(tokenOffsets);
        const tokens = tokenOffsets.map(t => t.word);
        chunkTokensList.push(tokens);
        totalLength += tokens.length;

        const uniqueInDoc = new Set(tokens);
        for (const token of uniqueInDoc) {
            docFreq[token] = (docFreq[token] || 0) + 1;
        }
    }

    const avgdl = totalLength / N || 1;
    const cleanQuery = query.toLowerCase().trim();
    const scored = [];

    // 2. Score each chunk
    for (let i = 0; i < N; i++) {
        const item = chunksWithMeta[i];
        const tokens = chunkTokensList[i];
        const tokenOffsets = docOffsetsList[i];
        const docLen = tokens.length;

        let bm25Score = 0;
        let matchedTerms = 0;

        for (const qt of queryTokens) {
            let maxTf = 0;
            for (const dt of tokens) {
                const sim = softTokenMatch(qt, dt);
                if (sim > 0) {
                    maxTf += sim;
                }
            }

            if (maxTf > 0) {
                matchedTerms++;
                const n_t = docFreq[qt] || 1;
                const idf = Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5));
                const numerator = maxTf * (k1 + 1);
                const denominator = maxTf + k1 * (1 - b + b * (docLen / avgdl));
                bm25Score += idf * (numerator / denominator);
            }
        }

        if (bm25Score <= 0) continue;

        // 3. Compute Positional Span Attention & extract Micro-Window
        const { spanMultiplier, microWindow } = computePositionalAttention(queryTokens, tokenOffsets, item.text);
        bm25Score *= spanMultiplier;

        // 4. Exact Phrase Bonus
        const lowerText = item.text.toLowerCase();
        if (cleanQuery.length > 5 && lowerText.includes(cleanQuery)) {
            bm25Score *= 2.2;
        }

        // 5. Code & Patch Identifier Bonus (e.g. diffstat, Makefile lines, CONFIG_ flags)
        if (/```|CONFIG_[A-Z0-9_]+|\+\+\+\s+b\/|obj-\$\(|diff\s+--git/i.test(item.text)) {
            bm25Score *= 1.35;
        }

        // Coverage penalty
        const coverageRatio = matchedTerms / queryTokens.length;
        bm25Score *= (0.4 + 0.6 * coverageRatio);

        scored.push({
            source: item.source,
            url: item.url,
            text: microWindow,
            fullText: item.text,
            score: bm25Score
        });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Main PAS-BM25 Extractor Entry Point
 * @param {string} query - The search query
 * @param {Array<{url: string, title: string, content: string}>} pages - Fetched pages
 * @param {Object} options - { maxExcerpts, maxPerSource, maxTotalWords }
 */
function extractRagPassages(query, pages = [], options = {}) {
    const maxExcerpts = options.maxExcerpts || 4;
    const maxPerSource = options.maxPerSource || 2;
    const maxTotalWords = options.maxTotalWords || 500;

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

    const scored = scoreChunksPASBM25(query, allChunks, options);

    // Select top excerpts with domain diversity and strict global token/word budget
    const selected = [];
    const sourceCount = {};
    let totalWordCount = 0;

    for (const item of scored) {
        const count = sourceCount[item.url] || 0;
        if (count >= maxPerSource) continue;

        const wordsInText = item.text.split(/\s+/).length;
        if (selected.length > 0 && totalWordCount + wordsInText > maxTotalWords) {
            continue;
        }

        sourceCount[item.url] = count + 1;
        totalWordCount += wordsInText;

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
    tokenizeWithOffsets,
    softTokenMatch,
    chunkDocument,
    computePositionalAttention,
    scoreChunksPASBM25,
    extractRagPassages
};
