# The Council: nodes and states

These diagrams describe the planned system before implementation and deployment.

## Component nodes

![Council component nodes](components-map.png)

The calling agent writes candidate recommendations. The XState core returns states and effect intents. The controller performs external I/O.

The three reviewers have equal acceptance authority. The fresh judge checks evidence between reviewer phases and has no vote.

The component image shows the default Astra/Argon/Opus roster and Astra judge. `council.yaml` can replace those models within the configured family seats.

Each run freezes its configuration. A different roster changes worker selections, not these 14 control states or consensus authority.

## Control states

![Council state map](states-map.png)

The map shows all 14 control states and the main decision path. Selected return paths are summarized to keep the image readable.

The full Mermaid source also includes context resubmission, authorized remedies, and the early missing-input path.

The default limit is three admitted rounds. A round counts when its first initial-review inference starts.

## Cancellation and recovery

![Council recovery map](recovery-map.png)

A timeout or missing observation does not prove exit. Recovery inspects the existing attempt before any replacement launch.

Every decision outcome requires an explicit operational settlement state. Unknown resource state remains visible.

## Editable source and evidence

- [Canonical diagram model](the-council.json).
- [Mermaid source](the-council.md).
- [Component SVG](components-map.svg), [state SVG](states-map.svg), and [recovery SVG](recovery-map.svg).
- [Implementation plan](../plans/2026-10-23-the-council-implementation-plan.md).

The diagram skill validated the canonical model and exported the Mermaid source using compatibility profile `11.16.1`.

The visible maps use a separate readable SVG layout. Sharp rendered those SVG files to PNG. They are illustrations of the canonical model.

Static validation and these images do not prove native Mermaid rendering, XState execution, provider qualification, or deployment.
