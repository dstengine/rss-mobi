// Copy buttons: <button data-copy="#input-id">. Falls back to selecting
// the text where the clipboard API is refused (older iOS, plain http).
export function wireCopyButtons(onCopy?: (b: HTMLButtonElement) => void) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    b.addEventListener("click", async () => {
      const input = document.querySelector<HTMLInputElement>(b.dataset.copy!);
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      const label = b.textContent;
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = label), 2000);
      onCopy?.(b);
    });
  }
}
