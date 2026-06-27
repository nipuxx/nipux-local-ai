export const DEFAULT_VIDEO_COMMAND_PLACEHOLDER = "/path/to/local-video-command";

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function videoStartCommand(command = process.env.NIPUX_VIDEO_COMMAND || DEFAULT_VIDEO_COMMAND_PLACEHOLDER) {
  return `NIPUX_VIDEO_COMMAND=${shellArg(command)} bun run worker:video`;
}

export function videoWorkerContract() {
  return "Command receives a JSON request path and output video path: {input} {output}. Override with NIPUX_VIDEO_ARGS.";
}
