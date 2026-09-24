// Copy buttons: <button data-copy="#id">, rendered by CopyButton.astro.
// The target is an input (its value is copied) or a link (its href: the
// link may show the address without its https://, the copy is whole).
// Falls back to selecting the text where the clipboard API is refused
// (older iOS, plain http). While "Copied" shows, the button carries
// data-done, which swaps its copy mark for a tick.
export function wireCopyButtons(onCopy?: (b: HTMLButtonElement) => void) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = b.querySelector(".label") ?? b;
    let timer = 0;
    b.addEventListener("click", async () => {
      const target = document.querySelector<HTMLElement>(b.dataset.copy!);
      if (!target) return;
      const text =
        target instanceof HTMLInputElement ? target.value : target instanceof HTMLAnchorElement ? target.href : (target.textContent ?? "").trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        if (target instanceof HTMLInputElement) target.select();
        else getSelection()?.selectAllChildren(target);
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
