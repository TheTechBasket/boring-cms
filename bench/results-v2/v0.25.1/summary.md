# Boring CMS benchmark v0.25.1

Run: 2026-10-06T16:48:36.495Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 855.5 |
| field_text_write | 1723.9 |
| field_text_read | 9095.9 |
| field_markdown_write | 2366.9 |
| field_markdown_read | 10916 |
| field_number_write | 2739.9 |
| field_number_read | 11953.6 |
| field_boolean_write | 2602 |
| field_boolean_read | 13047.5 |
| field_date_write | 2747 |
| field_date_read | 12868.7 |
| field_datetime_write | 2675.7 |
| field_datetime_read | 13713.6 |
| field_json_write | 2758.8 |
| field_json_read | 14002.3 |
| field_image_write | 2764.6 |
| field_image_read | 13782.1 |
| field_counter_write | 2742.6 |
| field_counter_read | 13653.9 |
| field_counter_vote | 11981.6 |
| field_counter_read_totals | 13433.7 |
| field_countermap_write | 2752.9 |
| field_countermap_read | 13583.8 |
| field_countermap_vote | 12142.7 |
| field_countermap_switch | 12396.2 |
| field_countermap_read_totals | 12268.4 |
| field_relation_write | 2642.3 |
| field_relation_read | 13395.4 |
| core_list | 7082.1 |
| core_304_etag | 11806.3 |
| core_hot_mixed | 11210.5 |
| core_media_upload_64kb | 1406.1 |
| core_media_serve_64kb | 4749.8 |
| core_update | 2722.2 |
| core_delete | 3007.3 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 0.93 / 2 |
| field_text_write | 0.54 / 0.81 |
| field_text_read | 1.64 / 2.26 |
| field_markdown_write | 0.39 / 0.45 |
| field_markdown_read | 1.31 / 1.58 |
| field_number_write | 0.36 / 0.41 |
| field_number_read | 1.15 / 1.71 |
| field_boolean_write | 0.35 / 0.41 |
| field_boolean_read | 1.14 / 1.48 |
| field_date_write | 0.35 / 0.41 |
| field_date_read | 1.08 / 1.67 |
| field_datetime_write | 0.35 / 0.42 |
| field_datetime_read | 1.07 / 1.2 |
| field_json_write | 0.35 / 0.42 |
| field_json_read | 1.07 / 1.16 |
| field_image_write | 0.34 / 0.38 |
| field_image_read | 1.06 / 1.12 |
| field_counter_write | 0.34 / 0.37 |
| field_counter_read | 1.06 / 1.21 |
| field_counter_vote | 2.33 / 4.27 |
| field_counter_read_totals | 1.09 / 1.17 |
| field_countermap_write | 0.34 / 0.4 |
| field_countermap_read | 1.07 / 1.28 |
| field_countermap_vote | 2.29 / 3.39 |
| field_countermap_switch | 2.31 / 3.18 |
| field_countermap_read_totals | 1.13 / 1.78 |
| field_relation_write | 0.34 / 0.42 |
| field_relation_read | 1.08 / 1.14 |
| core_list | 1.99 / 2.74 |
| core_304_etag | 1.2 / 1.34 |
| core_hot_mixed | 2.58 / 3.31 |
| core_media_upload_64kb | 0.59 / 0.75 |
| core_media_serve_64kb | 2.69 / 8.52 |
| core_update | 0.35 / 0.41 |
| core_delete | 0.32 / 0.35 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 176 | 16 |
