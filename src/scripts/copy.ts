// Copy buttons: <button data-copy="#input-id">, rendered by
// CopyButton.astro. Falls back to selecting the text where the clipboard
// API is refused (older iOS, plain http). While "Copied" shows, the button
// carries data-done, which swaps its copy mark for a tick.
export function wireCopyButtons(onCopy?: (b: HTMLButtonElement) => void) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = b.querySelector(".label") ?? b;
    let timer = 0;
    b.addEventListener("click", async () => {
      const input = document.querySelector<HTMLInputElement>(b.dataset.copy!);
      if (!input) return;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      label.textContent = "Copied";
      b.dataset.done = "";
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = "Copy";
        delete b.dataset.done;
      }, 2000);
      onCopy?.(b);
    });
  }
}
