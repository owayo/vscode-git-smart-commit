import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dependency security overrides", () => {
	it("keeps VS Code engine aligned with @types/vscode", () => {
		const packageJson = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf-8"),
		);
		const vscodeTypesVersion = packageJson.devDependencies?.["@types/vscode"];

		expect(typeof vscodeTypesVersion).toBe("string");
		expect(packageJson.engines?.vscode).toBe(`^${vscodeTypesVersion}`);
	});

	it("keeps packageManager aligned with the pnpm pinned in mise.toml", () => {
		const packageJson = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf-8"),
		);
		// pnpm の版は mise.toml の [tools] が正。CI も mise-action でこの版を入れる。
		let section = "";
		let misePnpmVersion: string | undefined;
		for (const rawLine of readFileSync(
			join(process.cwd(), "mise.toml"),
			"utf-8",
		).split("\n")) {
			const line = rawLine.replace(/#.*$/, "").trim();
			const header = line.match(/^\[([^\]]+)\]$/);
			if (header) {
				section = header[1] ?? "";
				continue;
			}
			const pnpm = line.match(/^pnpm\s*=\s*"([^"]+)"$/);
			if (section === "tools" && pnpm) {
				misePnpmVersion = pnpm[1];
			}
		}

		expect(misePnpmVersion).toMatch(/^\d+\.\d+\.\d+$/);
		expect(packageJson.packageManager).toBe(`pnpm@${misePnpmVersion}`);
	});

	it("fails instead of switching pnpm when packageManager differs", () => {
		// 既定の pmOnFail: download は packageManager の版を黙って取得・実行し、
		// mise.toml で固定した pnpm を上書きする。pnpm が読むのはトップレベルの設定だけなので、
		// 字下げの無い行だけを照合し、別のキーの配下へ移った設定やコメントアウトを見逃さない。
		// 値の引用符と行末のコメントは YAML として同じ意味なので許容する。
		const workspaceConfig = readFileSync(
			join(process.cwd(), "pnpm-workspace.yaml"),
			"utf-8",
		);

		expect(workspaceConfig).toMatch(
			/^pmOnFail:[ \t]*(["']?)error\1[ \t]*(?:#.*)?\r?$/m,
		);
	});

	it("keeps Biome schema aligned with the installed version", () => {
		const biomePackage = JSON.parse(
			readFileSync(
				join(
					process.cwd(),
					"node_modules",
					"@biomejs",
					"biome",
					"package.json",
				),
				"utf-8",
			),
		);
		const biomeConfig = readFileSync(
			join(process.cwd(), "biome.jsonc"),
			"utf-8",
		);
		const schemaVersion = biomeConfig.match(
			/^\s*"\$schema"\s*:\s*"https:\/\/biomejs\.dev\/schemas\/([^/]+)\/schema\.json"/m,
		)?.[1];

		expect(schemaVersion).toBe(biomePackage.version);
	});

	it("keeps transitive dependency overrides at patched versions", () => {
		const workspaceConfig = readFileSync(
			join(process.cwd(), "pnpm-workspace.yaml"),
			"utf-8",
		);
		// YAML 全文への部分一致 (toContain) だと `# "js-yaml@...": "..."` のような
		// コメントアウトや `dummy: true # "..."` のようなインラインコメントにも一致して
		// しまい、無効化された override を検出できずセキュリティ退行を見逃す。
		// trim した各行と override 文字列の完全一致で照合し、コメント混入を排除する。
		const activeConfigLines = workspaceConfig
			.split("\n")
			.map((line) => line.trim());

		// pnpm audit で検出した transitive dependency の脆弱性を、override で patched version へ固定する。
		// ここに載せた override が消えると `pnpm audit --audit-level moderate` の clean 状態が崩れる。
		const requiredOverrides = [
			'"@azure/identity@>=4.0.0 <4.14.1": "4.14.1"',
			'"@isaacs/brace-expansion@<=5.0.0": "5.0.1"',
			'"ajv@>=7.0.0-alpha.0 <8.18.0": "8.20.0"',
			'"brace-expansion@<1.1.13": "1.1.13"',
			'"brace-expansion@>=3.0.0 <5.0.12": "5.0.12"',
			'"esbuild@>=0.17.0 <0.28.1": "0.28.1"',
			'"fast-uri@>=3.0.0 <3.1.9": "3.1.9"',
			'"form-data@>=4.0.0 <4.0.6": "4.0.6"',
			'"js-yaml@>=4.0.0 <4.3.2": "4.3.2"',
			'"linkify-it@<=5.0.1": "5.0.2"',
			'"lodash@<=4.17.23": "4.18.1"',
			'"markdown-it@<14.3.3": "14.3.3"',
			'"minimatch@<3.1.4": "3.1.4"',
			'"minimatch@>=10.0.0 <11.0.1": "11.0.1"',
			'"nanoid@<3.3.18": "3.3.18"',
			'"picomatch@<2.3.2": "2.3.2"',
			'"picomatch@>=4.0.0 <4.0.4": "4.0.7"',
			'"postcss@<8.5.23": "8.5.23"',
			'"qs@<6.16.1": "6.16.1"',
			'"rollup@>=4.0.0 <4.59.0": "4.60.4"',
			'"source-map-js@>=1.0.0 <1.2.2": "1.2.2"',
			'"tmp@<0.2.7": "0.2.7"',
			'"underscore@<=1.13.7": "1.13.8"',
			'"undici@>=7.0.0 <7.30.1": "7.30.1"',
			'"vite@>=7.0.0 <7.3.7": "7.3.7"',
		];

		for (const override of requiredOverrides) {
			expect(activeConfigLines).toContain(override);
		}
	});
});
