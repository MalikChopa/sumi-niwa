// Entrée de bench.html : `?mode=probe` lance la sonde particules (J3, en tête) ; sinon le bench des paliers.
const out = document.getElementById('out') as HTMLElement;
const mode = new URLSearchParams(location.search).get('mode');

async function main(): Promise<void> {
  if (mode === 'probe') {
    const { runProbe } = await import('./probe');
    await runProbe(out);
  } else {
    const { runBench } = await import('./bench');
    await runBench(out);
  }
  const copy = document.getElementById('copy') as HTMLButtonElement;
  copy.hidden = false;
  copy.addEventListener('click', () => {
    const w = window as unknown as { __probe?: unknown; __bench?: unknown };
    const json = JSON.stringify(mode === 'probe' ? w.__probe : w.__bench, null, 2);
    navigator.clipboard.writeText(json).then(
      () => (copy.textContent = 'Copié'),
      () => (out.textContent += '\n' + json),
    );
  });
}

main().catch((e) => {
  out.textContent += '\nERREUR : ' + String(e instanceof Error ? e.message : e);
});
