# A Hindsight image with the bifrost extension in it.
#
# Build from the repository root so the extension sources are in context:
#   docker build -f hindsight-extensions/bifrost/Dockerfile -t hindsight-with-bifrost .
ARG HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight:latest
FROM ${HINDSIGHT_IMAGE}

# No third-party dependencies beyond the server itself.
COPY hindsight-extensions/bifrost/hindsight_ext_bifrost /app/extensions/hindsight_ext_bifrost
ENV PYTHONPATH=/app/extensions

# Fail the build, rather than the first LLM call, if the extension is not importable.
RUN /app/api/.venv/bin/python -c "import hindsight_ext_bifrost"
