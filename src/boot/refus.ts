// Niveau `refus` : papier uni (CSS), message FR + EN et bouton « Réessayer » (déjà dans index.html).
export function showRefus(): void {
  const panel = document.getElementById('refus');
  if (panel) panel.hidden = false;
  document.getElementById('retry')?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('force'); // sans cela, ?force=refus reboucle
    window.location.assign(url.toString());
  });
}
