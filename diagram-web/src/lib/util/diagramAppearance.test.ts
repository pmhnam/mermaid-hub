import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { diagramForAppearance } from './diagramAppearance';

describe('local diagram appearance', () => {
  it('uses a dark render config without modifying the saved config or source', () => {
    const config = Object.freeze({
      theme: 'default' as const,
      themeVariables: Object.freeze({ fontSize: '18px', darkMode: false })
    });
    const code = 'erDiagram\nA ||--o{ B : contains';
    const result = diagramForAppearance(code, config, 'dark');
    expect(result.config).toMatchObject({
      theme: 'dark',
      themeVariables: { fontSize: '18px', darkMode: true }
    });
    expect(config.theme).toBe('default');
    expect(config.themeVariables.darkMode).toBe(false);
    expect(result.code).toBe(code);
  });
  it('overrides a frontmatter theme while preserving layout, fonts, title and diagram body', () => {
    const code =
      '---\ntitle: My ERD\nconfig:\n  theme: default\n  layout: elk\n  er:\n    layoutDirection: TB\n  themeVariables:\n    fontSize: 18px\n---\nerDiagram\n"catalog.PRODUCTS" {\n UUID id PK\n}';
    const result = diagramForAppearance(code, {}, 'dark');
    const metadata = parse(result.code.split('---')[1]);
    expect(metadata).toMatchObject({
      title: 'My ERD',
      config: {
        theme: 'dark',
        layout: 'elk',
        er: { layoutDirection: 'TB' },
        themeVariables: { fontSize: '18px', darkMode: true }
      }
    });
    expect(result.code.split('---')[2]).toBe(code.split('---')[2]);
    expect(code).toContain('theme: default');
    expect(diagramForAppearance(code, {}, 'light').code).toBe(code);
  });
  it('supports aliased config and CRLF input', () => {
    const code =
      '---\r\ndefaults: &settings {theme: forest, layout: elk}\r\nconfig: *settings\r\n---\r\nerDiagram\r\nA ||--o{ B : contains';
    const result = diagramForAppearance(code, {}, 'dark');
    expect(parse(result.code.split('---')[1]).config).toMatchObject({
      theme: 'dark',
      layout: 'elk'
    });
    expect(result.code).toContain('erDiagram\r\nA ||--o{ B : contains');
  });
  it('leaves standalone embed themes and light-mode custom palettes intact', () => {
    const config = { theme: 'forest' as const };
    expect(diagramForAppearance('graph TD; A-->B', config).config).toBe(config);
    expect(diagramForAppearance('graph TD; A-->B', config, 'light').config).toBe(config);
  });
});
