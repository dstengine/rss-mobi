// Copy buttons: <button data-copy="#id">, rendered by CopyButton.astro.
// The target is an input (its value is copied) or a link (its href: the
// link may show the address without its https://, the copy is whole). A
// button in a list, with no address shown beside it, carries the address
// itself instead: <button data-copy data-copy-url="https://…">.
// Falls back to selecting the text where the clipboard API is refused
// (older iOS, plain http). While "Copied" shows, the button carries
// data-done, which swaps its copy mark for a tick.
export function wireCopyButtons(onCopy?: (b: HTMLButtonElement) => void) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const label = b.querySelector(".label") ?? b;
    // Our own markup, which may hold a word only wide screens show.
    const idle = label.innerHTML;
    let timer = 0;
    b.addEventListener("click", async () => {
      let target = b.dataset.copy ? document.querySelector<HTMLElement>(b.dataset.copy) : null;
      const given = b.dataset.copyUrl;
      if (!target && !given) return;
      const text =
        given ??
        (target instanceof HTMLInputElement ? target.value : target instanceof HTMLAnchorElement ? target.href : (target!.textContent ?? "").trim());
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        let temp: HTMLInputElement | null = null;
        if (!target) {
          temp = Object.assign(document.createElement("input"), { value: text, readOnly: true });
          b.after(temp);
          target = temp;
        }
        if (target instanceof HTMLInputElement) target.select();
        else getSelection()?.selectAllChildren(target);
        document.execCommand("copy");
        temp?.remove();
      }
      label.textContent = "Copied";
      b.dataset.done = "";
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.innerHTML = idle;
        delete b.dataset.done;
      }, 2000);
      onCopy?.(b);
    });
  }
}
