import type { Env } from '../types';
import { monitor } from './monitor';
import { runPublishing } from '../social/queue';
import { collectRetailerOffers } from './retailer-offers';
export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await collectRetailerOffers(env);
        await monitor(env, undefined, `monitor:${Math.floor(controller.scheduledTime / 1800000)}`);
        await runPublishing(env);
      })(),
    );
  },
  fetch() {
    return new Response('DealRadar background worker. No public control endpoints.', {
      status: 404,
    });
  },
};
