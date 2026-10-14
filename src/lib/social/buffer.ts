export interface Channel {
  id: string;
  name: string;
  service: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
}
export interface RemotePost {
  id: string;
  status: string;
  dueAt?: string | null;
  sentAt?: string | null;
}
export class BufferError extends Error {
  constructor(
    public kind: 'rate-limit' | 'auth' | 'rejected' | 'uncertain',
    public retryAfter = 60000,
  ) {
    super(
      `Buffer ${kind}; ${kind === 'uncertain' ? 'reconcile in Buffer before retrying' : kind === 'auth' ? 'check credentials and account permissions' : 'check connection or retry after cooldown'}`,
    );
  }
}
export const CHANNELS = `query DealRadarChannels($input: ChannelsInput!) { channels(input: $input) { id name service isDisconnected isLocked isQueuePaused } }`;
export const ORGANIZATIONS = `query { account { organizations { id name } } }`;
const selection = `__typename ... on PostActionSuccess { post { id status dueAt } } ... on MutationError { message }`;
export const CREATE_DRAFT = `mutation DealRadarDraft($input: CreatePostInput!) { createPost(input: $input) { ${selection} } }`;
export const QUEUE_POST = `mutation DealRadarSchedule($input: EditPostInput!) { editPost(input: $input) { ${selection} } }`;
export const GET_POST = `query DealRadarPost($input: PostInput!) { post(input: $input) { id status dueAt sentAt } }`;
export class BufferClient {
  constructor(
    private token: string,
    private request: typeof fetch = fetch,
  ) {}
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.request('https://api.buffer.com', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BufferError('uncertain');
    }
    if (response.status === 429) {
      const h = response.headers.get('retry-after');
      const delay = h ? Number(h) * 1000 : 60000;
      throw new BufferError('rate-limit', Number.isFinite(delay) ? Math.max(60000, delay) : 60000);
    }
    if (response.status === 401 || response.status === 403) throw new BufferError('auth');
    if (!response.ok) throw new BufferError('uncertain');
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new BufferError('uncertain');
    }
    if (body.errors?.length) {
      const code = String(body.errors[0]?.extensions?.code ?? '');
      throw new BufferError(
        /RATE|LIMIT/.test(code) ? 'rate-limit' : /AUTH|FORBIDDEN/.test(code) ? 'auth' : 'rejected',
      );
    }
    if (!body.data) throw new BufferError('uncertain');
    return body.data;
  }
  organizations() {
    return this.query<{ account: { organizations: { id: string; name: string }[] } }>(
      ORGANIZATIONS,
    );
  }
  async channels(organizationId: string) {
    return (await this.query<{ channels: Channel[] }>(CHANNELS, { input: { organizationId } }))
      .channels;
  }
  async ensureXChannel(organizationId: string, channelId: string) {
    const c = (await this.channels(organizationId)).find((c) => c.id === channelId);
    if (!c || c.service !== 'twitter' || c.isDisconnected || c.isLocked || c.isQueuePaused)
      throw new BufferError('auth');
    return c;
  }
  async createDraft(channelId: string, text: string): Promise<RemotePost> {
    const d = await this.query<{ createPost: any }>(CREATE_DRAFT, {
      input: {
        channelId,
        text,
        assets: [],
        needsApproval: false,
        schedulingType: 'automatic',
        mode: 'addToQueue',
        saveToDraft: true,
        source: 'DealRadar',
      },
    });
    return this.success(d.createPost);
  }
  async enqueue(id: string, dueAt: string): Promise<RemotePost> {
    const d = await this.query<{ editPost: any }>(QUEUE_POST, {
      input: {
        id,
        mode: 'customScheduled',
        dueAt,
        schedulingType: 'automatic',
        saveToDraft: false,
      },
    });
    return this.success(d.editPost);
  }
  async withdraw(id: string): Promise<RemotePost> {
    const data = await this.query<{ editPost: any }>(QUEUE_POST, {
      input: { id, saveToDraft: true },
    });
    return this.success(data.editPost);
  }
  async status(id: string, _organizationId: string) {
    return (await this.query<{ post: RemotePost }>(GET_POST, { input: { id } })).post;
  }
  private success(payload: any): RemotePost {
    if (payload?.__typename === 'PostActionSuccess' && payload.post?.id) return payload.post;
    throw new BufferError(
      payload?.__typename === 'LimitReachedError'
        ? 'rate-limit'
        : payload?.__typename === 'UnauthorizedError'
          ? 'auth'
          : 'rejected',
    );
  }
}
