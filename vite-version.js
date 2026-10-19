// Numéro de build : injecté dans le code (__BUILD__) et publié dans /version.json
export function versionFile() {
  const BUILD = String(Date.now());
  return {
    name: 'version-file',
    config: () => ({ define: { __BUILD__: JSON.stringify(BUILD) } }),
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD }) }); },
  };
}
