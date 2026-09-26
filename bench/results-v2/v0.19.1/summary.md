# Boring CMS benchmark v0.19.1

Run: 2026-09-26T06:28:29.187Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 810.6 |
| field_text_write | 1544.9 |
| field_text_read | 8434.8 |
| field_markdown_write | 2127.5 |
| field_markdown_read | 8919.5 |
| field_number_write | 2377.4 |
| field_number_read | 9835.9 |
| field_boolean_write | 2257.9 |
| field_boolean_read | 10407.9 |
| field_date_write | 2543.5 |
| field_date_read | 10675.5 |
| field_datetime_write | 2412.2 |
| field_datetime_read | 10690.4 |
| field_json_write | 2287.5 |
| field_json_read | 10393.2 |
| field_image_write | 2474.6 |
| field_image_read | 10283.3 |
| field_relation_write | 2567.5 |
| field_relation_read | 10972.3 |
| core_list | 7130.8 |
| core_304_etag | 11683.4 |
| core_hot_mixed | 10299.5 |
| core_media_upload_64kb | 969.6 |
| core_media_serve_64kb | 3816.4 |
| core_update | 2016.4 |
| core_delete | 2352.8 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 1.14 / 2.28 |
| field_text_write | 0.6 / 0.88 |
| field_text_read | 1.65 / 3.17 |
| field_markdown_write | 0.44 / 0.53 |
| field_markdown_read | 1.42 / 3.06 |
| field_number_write | 0.41 / 0.49 |
| field_number_read | 1.29 / 2.74 |
| field_boolean_write | 0.41 / 0.52 |
| field_boolean_read | 1.27 / 2.64 |
| field_date_write | 0.38 / 0.45 |
| field_date_read | 1.23 / 2.57 |
| field_datetime_write | 0.39 / 0.47 |
| field_datetime_read | 1.23 / 2.57 |
| field_json_write | 0.4 / 0.51 |
| field_json_read | 1.27 / 2.64 |
| field_image_write | 0.38 / 0.46 |
| field_image_read | 1.29 / 2.7 |
| field_relation_write | 0.38 / 0.47 |
| field_relation_read | 1.21 / 2.52 |
| core_list | 1.96 / 2.89 |
| core_304_etag | 1.2 / 2.03 |
| core_hot_mixed | 2.76 / 4.99 |
| core_media_upload_64kb | 0.77 / 2.48 |
| core_media_serve_64kb | 3.45 / 8.88 |
| core_update | 0.48 / 0.58 |
| core_delete | 0.41 / 0.49 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 139 | 11 |
