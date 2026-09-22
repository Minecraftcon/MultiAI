import { toolFetch } from "../http.js";

/* =========================================================
   ARTIFACT WRITER TOOL
   Specialized tool for DeepSearch / Research chats to save
   milestone notes, outlines, plans, and reports into the
   chat's persistent artifacts directory ($ARTIFACTS/).
   ========================================================= */

export const artifactWriterTool = {
    name: "artifact_writer",
    schema: {
        type: "function",
        function: {
            name: "artifact_writer",
            description: "Save, write, or update a persistent research artifact, roadmap, or milestone document in the current chat's artifacts directory. Files are saved in markdown format and can be viewed by the user.",
            parameters: {
                type: "object",
                properties: {
                    filename: {
                        type: "string",
                        description: "Name of the artifact file to save (e.g. 'roadmap.md', 'tasklist.md', 'notes.md')."
                    },
                    content: {
                        type: "string",
                        description: "Full markdown text content to write into the artifact."
                    },
                    description: {
                        type: "string",
                        description: "Short 1-line description of the artifact for user visibility."
                    }
                },
                required: ["filename", "content"]
            }
        }
    },
    handler: async (args, { genState }) => {
        let cleanName = String(args.filename || "artifact.md").trim();
        cleanName = cleanName.replace(/^[/\\]+/, "").replace(/^\$ARTIFACTS[/\\]*/i, "");
        if (!cleanName) cleanName = "artifact.md";

        const targetPath = `$ARTIFACTS/${cleanName}`;
        const content = String(args.content || "");

        await toolFetch("/api/file/write", {
            method: "POST",
            body: {
                path: targetPath,
                content,
                action: "write",
                overwrite: true
            },
            genState
        });

        return {
            success: true,
            filename: cleanName,
            path: targetPath,
            sizeBytes: content.length,
            message: `Artifact '${cleanName}' successfully saved to chat artifacts.`
        };
    }
};
