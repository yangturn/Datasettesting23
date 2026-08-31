import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { toPersonSummary } from "@/lib/person";
import { listPersons, readPerson } from "@/server/storage/persons";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

export const personsRouter = createTRPCRouter({
  list: publicProcedure.query(async () => {
    const persons = await listPersons();
    return persons.map(toPersonSummary);
  }),

  byId: publicProcedure
    .input(z.object({ personId: z.string().min(1) }))
    .query(async ({ input }) => {
      const person = await readPerson(input.personId);
      if (!person) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No person with id "${input.personId}"`,
        });
      }
      return person;
    }),
});
