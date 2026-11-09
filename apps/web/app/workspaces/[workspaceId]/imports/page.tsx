import { findWorkspaceSection } from '@lead-fennec-ai/shared';
import { WorkspacePage } from '../workspace-page';
import { ImportsHome } from './imports-home';

const imports = findWorkspaceSection('imports');

/** The Imports page (task 07C): the server checks access, then the forms and runs render. */
export default async function ImportsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (imports === undefined) {
    throw new Error('The imports section is missing from the registry');
  }
  return (
    <WorkspacePage
      workspaceId={workspaceId}
      section={imports}
      render={() => <ImportsHome />}
    />
  );
}
