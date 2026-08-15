/**
 * A route that exists but is not built yet.
 *
 * **Deliberately not a copy of the prototype's page.** Those four components
 * are deleted: they talked to a dead backend at twenty hardcoded URLs, reported
 * failures through `alert()`, and read identity out of `localStorage`. Keeping
 * them "until the real one lands" would mean shipping F-01, F-12 and F-14 in a
 * screen that looks finished.
 *
 * Saying so plainly is the point. A stub that renders an empty dashboard is
 * indistinguishable from a broken one.
 */

export function Placeholder({ title, task }: { title: string; task: string }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm text-slate-600">
        This view is not built yet. It arrives in <code>{task}</code>; the API behind it is
        finished and covered by tests.
      </p>
    </main>
  );
}
