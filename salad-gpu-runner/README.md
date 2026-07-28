# Salad Generic GPU Runner

Public bootstrap and FastAPI service for a Salad Ubuntu GPU container.

## Salad startup fields

Command:

```text
/bin/bash
```

Argument 1:

```text
-lc
```

Argument 2:

```bash
curl -fsSL https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/salad-gpu-runner/bootstrap.sh -o /tmp/bootstrap.sh && bash /tmp/bootstrap.sh
```

Set the Salad environment variable `RUNNER_API_KEY` to a long random secret. Expose port `8888`, enable Salad gateway authentication, and keep one replica.

## Upload a job

Create a ZIP containing your code and optional `requirements.txt`, then submit it with a JSON manifest:

```bash
curl -X POST 'https://YOUR-SALAD-GATEWAY/jobs' \
  -H 'X-Runner-Key: YOUR_RUNNER_API_KEY' \
  -F 'bundle=@project.zip' \
  -F 'requested_job_id=btc-test-001' \
  -F 'manifest={"command":["python","train.py"],"requirements":"requirements.txt","env":{"EXAMPLE":"value"},"timeout_seconds":3600}'
```

The `env` object is passed only to the uploaded job process. Values are not returned by the API and the saved manifest contains only redacted values.

Endpoints:

- `GET /health`
- `POST /jobs`
- `GET /jobs`
- `GET /jobs/{job_id}`
- `GET /jobs/{job_id}/logs`
- `POST /jobs/{job_id}/cancel`
- `GET /jobs/{job_id}/artifacts`
- `GET /docs`

This service intentionally executes uploaded code. Protect it with Salad gateway authentication and `RUNNER_API_KEY`.
