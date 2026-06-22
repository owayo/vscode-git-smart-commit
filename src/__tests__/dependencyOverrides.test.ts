import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dependency security overrides", () => {
	it("keeps transitive dependency overrides at patched versions", () => {
		const workspaceConfig = readFileSync(
			join(process.cwd(), "pnpm-workspace.yaml"),
			"utf-8",
		);

		// pnpm audit で検出した transitive dependency の脆弱性を、override で patched version へ固定する。
		const requiredOverrides = [
			'"esbuild@>=0.17.0 <0.28.1": "0.28.1"',
			'"form-data@>=4.0.0 <4.0.6": "4.0.6"',
			'"js-yaml@<=4.1.1": "4.2.0"',
			'"markdown-it@<=14.1.1": "14.2.0"',
			'"tmp@<0.2.7": "0.2.7"',
			'"undici@>=7.0.0 <7.28.0": "7.28.0"',
			'"vite@>=7.0.0 <=7.3.4": "7.3.5"',
		];

		for (const override of requiredOverrides) {
			expect(workspaceConfig).toContain(override);
		}
	});
});
