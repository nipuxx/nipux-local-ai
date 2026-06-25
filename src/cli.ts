import { mkdirSync } from "node:fs";
import { MODEL_DIR, NIPUX_HOME, PORT, RUNTIME_DIR } from "./config.ts";
import { detectHardware } from "./services/hardware.ts";
import { downloadHuggingFaceFile, listHuggingFaceFiles, listModels, llamaServeCommand } from "./services/modelRegistry.ts";
import { testLlamaBackend } from "./providers/llamaCpp.ts";
import { getUsageSummary } from "./services/usage.ts";

const command = process.argv[2] ?? "help";

function printHelp() {
  console.log(`Nipux Local AI

Commands:
  bun run src/cli.ts install              Prepare local folders and print runtime setup
  bun run src/cli.ts doctor               Detect hardware and backend health
  bun run src/cli.ts models               List built-in model presets
  bun run src/cli.ts llama-command [id]   Print the llama.cpp serve command
  bun run src/cli.ts files <repo>         List GGUF files from Hugging Face
  bun run src/cli.ts download <repo> <file>
`);
}

async function main() {
  if (command === "install") {
    mkdirSync(NIPUX_HOME, { recursive: true });
    mkdirSync(MODEL_DIR, { recursive: true });
    mkdirSync(RUNTIME_DIR, { recursive: true });
    console.log(`Prepared ${NIPUX_HOME}`);
    console.log("No Docker is required.");
    console.log("Recommended llama.cpp install:");
    console.log("  macOS/Linux: curl -LsSf https://llama.app/install.sh | sh");
    console.log("  Windows:     winget install llama.cpp");
    console.log(`Then start the default model server:\n  ${llamaServeCommand("balanced")}`);
    return;
  }

  if (command === "doctor") {
    const [hardware, llama] = await Promise.all([detectHardware(), testLlamaBackend()]);
    console.log(JSON.stringify({ home: NIPUX_HOME, port: PORT, hardware, llama, usage: getUsageSummary() }, null, 2));
    return;
  }

  if (command === "models") {
    console.table(
      listModels().map((model) => ({
        id: model.id,
        repo: model.repo,
        quant: model.quant,
        ram: `${model.estimatedRamGb} GB`,
        state: model.state,
      })),
    );
    return;
  }

  if (command === "llama-command") {
    console.log(llamaServeCommand(process.argv[3] ?? "balanced"));
    return;
  }

  if (command === "files") {
    const repo = process.argv[3];
    if (!repo) throw new Error("repo is required");
    console.table(await listHuggingFaceFiles(repo));
    return;
  }

  if (command === "download") {
    const repo = process.argv[3];
    const file = process.argv[4];
    if (!repo || !file) throw new Error("repo and file are required");
    console.log(await downloadHuggingFaceFile(repo, file));
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
