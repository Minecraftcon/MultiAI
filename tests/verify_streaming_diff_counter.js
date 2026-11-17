import assert from "node:assert";
import {
    extractStreamingPath,
    extractStreamingDiffCounts,
    extractStreamingContent
} from "../UI/webui/src/components/chat-tool-badges.js";

console.log("================================================================================");
console.log(" STREAMING DIFF COUNTER & LIVE TICKER VERIFICATION");
console.log("================================================================================");

// 1. write_file incremental streaming additions
console.log("1. Verifying write_file incremental line counting...");
const writeChunks = [
    '{"path":"test.txt"',
    '{"path":"test.txt","content":"line 1"',
    '{"path":"test.txt","content":"line 1\\nline 2"',
    '{"path":"test.txt","content":"line 1\\nline 2\\nline 3\\nline 4"}',
];
assert.strictEqual(extractStreamingPath(writeChunks[0]), "test.txt");
assert.strictEqual(extractStreamingDiffCounts("write_file", writeChunks[0]), null);

const diff1 = extractStreamingDiffCounts("write_file", writeChunks[1]);
assert.deepStrictEqual(diff1, { adds: 1, dels: 0 });

const diff2 = extractStreamingDiffCounts("write_file", writeChunks[2]);
assert.deepStrictEqual(diff2, { adds: 2, dels: 0 });

const diff3 = extractStreamingDiffCounts("write_file", writeChunks[3]);
assert.deepStrictEqual(diff3, { adds: 4, dels: 0 });
console.log("  [PASS] write_file counts lines incrementally (+1, +2, +4).");

// 2. edit_file with Target & Replacement (case-insensitive & aliases)
console.log("2. Verifying edit_file / replace_file_content with Target & Replacement...");
const editChunks = [
    '{"Path":"src/index.js","Target":"old code\\nmore old"}',
    '{"Path":"src/index.js","Target":"old code\\nmore old","Replacement":"new line 1\\nnew line 2\\nnew line 3"}',
];
assert.strictEqual(extractStreamingPath(editChunks[0]), "src/index.js");

const editDiff1 = extractStreamingDiffCounts("edit_file", editChunks[0]);
assert.deepStrictEqual(editDiff1, { adds: 0, dels: 2 });

const editDiff2 = extractStreamingDiffCounts("edit_file", editChunks[1]);
assert.deepStrictEqual(editDiff2, { adds: 3, dels: 2 });

const replDiff = extractStreamingDiffCounts("replace_file_content", '{"path":"app.js","target_content":"one\\ntwo","replacement_content":"alpha\\nbeta\\ngamma"}');
assert.deepStrictEqual(replDiff, { adds: 3, dels: 2 });
console.log("  [PASS] edit_file and replace_file_content dynamically report deletions and additions.");

// 3. multi_replace_file_content chunk accumulation
console.log("3. Verifying multi_replace_file_content chunk accumulation...");
const multiChunk = '{"path":"main.c","replacement_chunks":[{"target_content":"a\\nb","replacement_content":"c\\nd\\ne"},{"target_content":"f","replacement_content":"g\\nh"}]}';
const multiDiff = extractStreamingDiffCounts("multi_replace_file_content", multiChunk);
assert.deepStrictEqual(multiDiff, { adds: 5, dels: 3 });
console.log("  [PASS] multi_replace_file_content aggregates multi-chunk diff stats.");

// 4. streaming content extraction
console.log("4. Verifying streaming content extraction...");
const contentChunk = '{"path":"hello.py","content":"def main():\\n    print(\\"hello world\\")\\n"}';
assert.strictEqual(extractStreamingContent(contentChunk), 'def main():\n    print("hello world")\n');
console.log("  [PASS] extractStreamingContent extracts code content with escape unescaping.");

console.log("================================================================================");
console.log("ALL STREAMING DIFF COUNTER VERIFICATIONS PASSED!");
console.log("================================================================================");

