import Link from "next/link";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { PersonDetail } from "@/components/person-detail";
import { NextStagePointer } from "@/components/stage-nav";
import { getServerCaller } from "@/trpc/server";
import type { Person } from "@/lib/person";

async function loadPerson(personId: string): Promise<Person> {
  const trpc = await getServerCaller();
  try {
    return await trpc.persons.byId({ personId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata(
  props: PageProps<"/stage-1/[personId]">,
) {
  const { personId } = await props.params;
  return { title: `${personId} · Stage 1` };
}

export default async function PersonPage(
  props: PageProps<"/stage-1/[personId]">,
) {
  const { personId } = await props.params;
  const person = await loadPerson(personId);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="space-y-3">
        <Link
          href="/stage-1"
          className="text-sm text-ink-muted hover:text-accent"
        >
          ← Stage 1
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-ink">
            {person.id}
          </h1>
          <p className="text-sm text-ink-subtle">
            {person.background.age} · {person.background.occupation}
          </p>
        </div>
      </header>

      <PersonDetail person={person} />

      <NextStagePointer
        stage="Stage 2"
        title="Episode Creation"
        description="Place this person in situations to produce scenario ground truth."
        href="/stage-2"
      />
    </main>
  );
}
