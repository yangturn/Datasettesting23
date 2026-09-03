from __future__ import annotations

from argparse import ArgumentParser

from run_behaviorchain import extract, positive_int, run_worker


def main() -> None:
    parser = ArgumentParser(
        description=(
            "Run the memory-ablated Full Flow, First Person evaluation with "
            "A-D options supplied only to the replacement final decision head."
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
        flow_set="first-person-head-only",
    )


if __name__ == "__main__":
    main()
