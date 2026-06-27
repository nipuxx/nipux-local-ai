export const DEFAULT_IMAGE_COMMAND_PLACEHOLDER = "/path/to/local-image-command";

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function imageStartCommand(command = process.env.NIPUX_IMAGE_COMMAND || DEFAULT_IMAGE_COMMAND_PLACEHOLDER) {
  return `NIPUX_IMAGE_COMMAND=${shellArg(command)} bun run worker:image`;
}

export function imageWorkerContract() {
  return "Command receives a JSON request path and output image path: {input} {output}. Override with NIPUX_IMAGE_ARGS.";
}
