# Boring CMS benchmark v0.23.0

Run: 2026-09-26T06:28:56.898Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 827.2 |
| field_text_write | 1491.2 |
| field_text_read | 8287.9 |
| field_markdown_write | 2083 |
| field_markdown_read | 10449.7 |
| field_number_write | 2272.3 |
| field_number_read | 10908.5 |
| field_boolean_write | 2393.2 |
| field_boolean_read | 12220.2 |
| field_date_write | 2320.7 |
| field_date_read | 11994.8 |
| field_datetime_write | 2371.6 |
| field_datetime_read | 12703.5 |
| field_json_write | 2161.3 |
| field_json_read | 10636.5 |
| field_image_write | 2207.9 |
| field_image_read | 12166.5 |
| field_counter_write | 2132.6 |
| field_counter_read | 11620.2 |
| field_counter_vote | 9689 |
| field_counter_read_totals | 11343 |
| field_relation_write | 2310.8 |
| field_relation_read | 11785.9 |
| core_list | 6649.3 |
| core_304_etag | 12495.3 |
| core_hot_mixed | 10636.7 |
| core_media_upload_64kb | 1177.3 |
| core_media_serve_64kb | 4529.2 |
| core_update | 2331.2 |
| core_delete | 2581.1 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 1.05 / 2.29 |
| field_text_write | 0.65 / 0.89 |
| field_text_read | 1.74 / 2.72 |
| field_markdown_write | 0.46 / 0.59 |
| field_markdown_read | 1.33 / 2.12 |
| field_number_write | 0.42 / 0.54 |
| field_number_read | 1.22 / 1.95 |
| field_boolean_write | 0.4 / 0.44 |
| field_boolean_read | 1.2 / 1.74 |
| field_date_write | 0.42 / 0.52 |
| field_date_read | 1.16 / 1.81 |
| field_datetime_write | 0.4 / 0.48 |
| field_datetime_read | 1.12 / 1.59 |
| field_json_write | 0.42 / 0.57 |
| field_json_read | 1.22 / 2.36 |
| field_image_write | 0.42 / 0.53 |
| field_image_read | 1.17 / 1.61 |
| field_counter_write | 0.45 / 0.56 |
| field_counter_read | 1.2 / 1.79 |
| field_counter_vote | 2.78 / 5.46 |
| field_counter_read_totals | 1.18 / 2 |
| field_relation_write | 0.42 / 0.54 |
| field_relation_read | 1.17 / 2.04 |
| core_list | 2.07 / 3 |
| core_304_etag | 1.17 / 1.33 |
| core_hot_mixed | 2.75 / 3.57 |
| core_media_upload_64kb | 0.68 / 1.12 |
| core_media_serve_64kb | 2.74 / 8.56 |
| core_update | 0.41 / 0.51 |
| core_delete | 0.38 / 0.45 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 143 | 14 |
