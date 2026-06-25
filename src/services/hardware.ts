import { totalmem, platform, arch } from "node:os";
import type { HardwareProfile } from "../types.ts";

async function run(command: string, args: string[], timeoutMs = 1600): Promise<string> {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timer);
    return `${stdout}\n${stderr}`;
  } catch {
    return "";
  }
}

function uniq(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function detectHardware(): Promise<HardwareProfile> {
  const os = platform();
  const totalRamGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  const notes: string[] = [];
  const gpuVendors: string[] = [];

  if (os === "darwin") {
    const displays = await run("system_profiler", ["SPDisplaysDataType"]);
    if (/apple|m1|m2|m3|m4|m5/i.test(displays)) gpuVendors.push("Apple");
    if (/amd|radeon/i.test(displays)) gpuVendors.push("AMD");
    if (/nvidia|geforce|rtx/i.test(displays)) gpuVendors.push("NVIDIA");
  } else if (os === "linux") {
    const lspci = await run("lspci", []);
    const nvidia = await run("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
    const rocm = await run("rocm-smi", ["--showproductname"]);
    if (/nvidia|geforce|rtx|quadro/i.test(`${lspci}\n${nvidia}`)) gpuVendors.push("NVIDIA");
    if (/amd|radeon|instinct/i.test(`${lspci}\n${rocm}`)) gpuVendors.push("AMD");
    if (/intel/i.test(lspci)) gpuVendors.push("Intel");
  } else if (os === "win32") {
    const output = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
    ]);
    if (/nvidia|geforce|rtx|quadro/i.test(output)) gpuVendors.push("NVIDIA");
    if (/amd|radeon|instinct/i.test(output)) gpuVendors.push("AMD");
    if (/intel/i.test(output)) gpuVendors.push("Intel");
  }

  let accelerator: HardwareProfile["accelerator"] = "cpu";
  if (os === "darwin" && gpuVendors.includes("Apple")) accelerator = "metal";
  else if (gpuVendors.includes("NVIDIA")) accelerator = "cuda";
  else if (gpuVendors.includes("AMD")) accelerator = os === "win32" ? "vulkan" : "rocm";
  else if (gpuVendors.includes("Intel")) accelerator = os === "win32" ? "directml" : "vulkan";

  if (accelerator === "cpu") notes.push("No supported GPU runtime was detected; use the Fast preset first.");
  if (accelerator === "rocm") notes.push("AMD support depends on the installed ROCm/Vulkan runtime and model backend.");
  if (os === "win32" && accelerator !== "cuda") notes.push("On Windows non-NVIDIA cards should prefer Vulkan/DirectML backends.");

  let recommendedPreset: HardwareProfile["recommendedPreset"] = "fast";
  if (totalRamGb >= 16) recommendedPreset = "balanced";
  if (totalRamGb >= 40 && accelerator !== "cpu") recommendedPreset = "smart";

  return {
    os,
    arch: arch(),
    totalRamGb,
    gpuVendors: uniq(gpuVendors),
    accelerator,
    recommendedPreset,
    notes,
  };
}
