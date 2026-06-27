// Electron's ipcRenderer.invoke rejects with a message prefixed
// "Error invoking remote method '<channel>': <Name>: <message>".
// Strip that wrapper so screens can show the underlying message to the user.
export function cleanIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^[A-Za-z]*Error:\s*/, '')
    .trim()
  return cleaned || raw
}
