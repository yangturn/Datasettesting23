export type DigitalTwinMethodScore = {
  key: string;
  label: string;
  kind: "dataset-testing" | "published-baseline";
  accuracy: number | null;
  exactMatch: number | null;
  comparedAnswers: number;
  participants: number;
  tasks: number;
};

export type DigitalTwinTaskScore = {
  taskKey: string;
  taskLabel: string;
  methods: Record<
    string,
    {
      accuracy: number | null;
      exactMatch: number | null;
      comparedAnswers: number;
    }
  >;
};

export type DigitalTwinStage4Report = {
  selectionId: string;
  selectedParticipants: number;
  heldOutAnswers: number;
  methods: DigitalTwinMethodScore[];
  tasks: DigitalTwinTaskScore[];
  baseline: {
    available: boolean;
    sourceUrl: string;
    revision: string;
    error: string | null;
  };
};
