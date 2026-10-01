#!/usr/bin/env node
import { query } from "@anthropic-ai/claude-agent-sdk";
import { main } from "./main.ts";

void main(process.argv.slice(2), query);
