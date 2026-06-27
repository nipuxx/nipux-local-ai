#!/usr/bin/env python3
import inspect
import json
import os
import sys


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main():
    if len(sys.argv) < 3:
        fail("Usage: diffusers-image.py <request.json> <output.png>")

    request_path = sys.argv[1]
    output_path = sys.argv[2]

    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except Exception as exc:
        fail(f"Missing local Diffusers dependencies: {exc}")

    with open(request_path, "r", encoding="utf-8") as handle:
        request = json.load(handle)

    prompt = (request.get("prompt") or "").strip()
    if not prompt:
        fail("prompt is required")

    model = os.environ.get("NIPUX_IMAGE_MODEL") or request.get("model") or "stabilityai/sdxl-turbo"
    width = int(request.get("width") or 1024)
    height = int(request.get("height") or 1024)
    seed = request.get("seed")
    negative_prompt = request.get("negative_prompt") or None

    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
    else:
        device = "cpu"
        dtype = torch.float32

    pipeline = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=dtype)
    pipeline.to(device)

    steps = int(os.environ.get("NIPUX_IMAGE_STEPS") or ("4" if "turbo" in model.lower() else "20"))
    guidance = float(os.environ.get("NIPUX_IMAGE_GUIDANCE") or ("0.0" if "turbo" in model.lower() else "7.5"))
    generator = None
    if isinstance(seed, int):
        generator = torch.Generator(device=device if device != "mps" else "cpu").manual_seed(seed)

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
    }
    signature = inspect.signature(pipeline.__call__)
    if negative_prompt and "negative_prompt" in signature.parameters:
        kwargs["negative_prompt"] = negative_prompt
    if generator is not None and "generator" in signature.parameters:
        kwargs["generator"] = generator

    image = pipeline(**kwargs).images[0]
    image.save(output_path)


if __name__ == "__main__":
    main()
