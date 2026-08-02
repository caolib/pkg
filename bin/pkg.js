#!/usr/bin/env bun
import { join } from "node:path"

const entry = join(import.meta.dir, "..", "src", "index.tsx")
await import(entry)
