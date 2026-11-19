# Mobile Coding & Custom AI Training Notes

This workspace file can be viewed, edited, and diffed directly from **Antigravity Mobile IDE**.

## Planned Ollama Custom Model Workflow (Once New PC Arrives)
1. Pull base coding checkpoints on the new PC (`ollama pull gemma4:26b`, `ollama pull qwen2.5-coder:14b`).
2. Expose Ollama on LAN/Tailscale (`OLLAMA_HOST=0.0.0.0:11434 ollama serve`).
3. Point the **Antigravity Mobile IDE** (`Multi-Agent` tab) to `http://<new-pc-ip>:11434`.
4. Add custom fine-tuned Modelfiles as dedicated agents in the mobile roster!

