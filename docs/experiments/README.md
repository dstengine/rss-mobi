# Experiments

One file per experiment, named by its id in `EXPERIMENTS`
(`src/lib/experiments.ts`). Write it **before** switching the experiment on:

- **Hypothesis** — one sentence.
- **Primary metric** — one, with how it is counted from `events` or Search
  Console.
- **Minimum sample** per variant, fixed now; nobody reads results before it.
- **Start and end dates.**
- **Result** — counts, z and p from `zTest()`, the decision, and the PR that
  removed the losing variant.

| id | kind | status |
|---|---|---|
| `feed-title-v1` | page | drafted, off |
| `submit-steps-v1` | visitor | drafted, off |
