export async function saveFileUrl(url: string, path: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The file could not be loaded. Try again.");
  const downloadUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = path.split(/[\\/]/).at(-1) || path;
    anchor.click();
  } finally {
    // Electron needs the blob URL to survive until its download starts.
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
  }
}
