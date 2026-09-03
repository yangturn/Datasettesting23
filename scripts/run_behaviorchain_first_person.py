from __future__ import annotations

from argparse import ArgumentParser

from run_behaviorchain import extract, positive_int, run_worker


def main() -> None:
    parser = ArgumentParser(
        description=(
            "Extract BehaviorChain when necessary, then run the memory-ablated "
            "Full Flow, First Person multiple-choice evaluation."
        )
    )
    parser.add_argument(
        "--sample",
        type=positive_int,
        metavar="N",
        help=(
            "sample N character files with the fixed seed 42; omit to run all "
            "characters"
        ),
    )
    parser.add_argument(
        "--concurrency",
        type=positive_int,
        metavar="N",
        help="maximum concurrent OpenRouter requests (default: 24)",
    )
    args = parser.parse_args()

    extract(quiet=True)
    run_worker(
        sample=args.sample,
        concurrency=args.concurrency,
        flow_set="first-person",
    )


if __name__ == "__main__":
    main()
