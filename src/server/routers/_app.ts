import { descriptionsRouter } from "@/server/routers/descriptions";
import { digitalTwinsRouter } from "@/server/routers/digital-twins";
import { personsRouter } from "@/server/routers/persons";
import { evaluationsRouter } from "@/server/routers/evaluations";
import { executionsRouter } from "@/server/routers/executions";
import { profilesRouter } from "@/server/routers/profiles";
import { runsRouter } from "@/server/routers/runs";
import { scenariosRouter } from "@/server/routers/scenarios";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({
    ok: true,
    checkedAt: new Date(),
  })),

  profiles: profilesRouter,
  digitalTwins: digitalTwinsRouter,
  descriptions: descriptionsRouter,
  persons: personsRouter,
  scenarios: scenariosRouter,
  executions: executionsRouter,
  evaluations: evaluationsRouter,
  runs: runsRouter,
});

export type AppRouter = typeof appRouter;
