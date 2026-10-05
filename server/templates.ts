interface TemplateEndpoint {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

const user = (id: unknown, name: string, role: string) => ({ id, name, email: `${name.toLowerCase()}@example.com`, role });

/** Starter sets that show what the tool can do. Bodies are stored as formatted JSON text. */
export const TEMPLATES: Record<string, TemplateEndpoint[]> = {
  users: [
    { method: 'GET', path: '/users', status: 200, body: { page: '{{query.page}}', users: [user(1, 'Asha', 'admin'), user(2, 'Ravi', 'editor'), user(3, 'Meera', 'viewer')] } },
    { method: 'GET', path: '/users/:id', status: 200, body: { ...user('{{params.id}}', 'Asha', 'admin'), lastSeen: '{{now}}' } },
    { method: 'POST', path: '/users', status: 201, body: { id: '{{uuid}}', name: '{{body.name}}', email: '{{body.email}}', createdAt: '{{now}}' } },
    { method: 'DELETE', path: '/users/:id', status: 200, body: { deleted: true, id: '{{params.id}}' } },
  ],
};
