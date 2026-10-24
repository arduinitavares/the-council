/** External IDs are frozen prior-ledger inputs; they cannot add edges back into this wave. */
export function validateQuestionDependencies(questions: readonly { id: string; dependencyIds: readonly string[] }[], externalIds: readonly string[] = []): void {
  const graph = new Map(questions.map(question => [question.id, question.dependencyIds]));
  if (graph.size !== questions.length) throw new Error('Duplicate question ID');
  const external = new Set(externalIds);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Cyclic question dependencies');
    if (visited.has(id)) return;
    const dependencies = graph.get(id);
    if (!dependencies) {
      if (external.has(id)) return;
      throw new Error(`Missing question dependency: ${id}`);
    }
    visiting.add(id);
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
}
