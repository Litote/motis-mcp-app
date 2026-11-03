#!/usr/bin/env bash
# Smoke test of the native executable in the Lambda runtime image (CI): catches missing native-image metadata (make trace).
# DynamoDB is DynamoDB Local, already listening on localhost:8000 with no table.
# Usage: ./gradlew :lambda:smokeTest, which mocks MOTIS on MOCK_MOTIS_PORT (MockMotisServer.kt)
set -euo pipefail

bootstrap=$1

# DynamoDB Local checks no signature, only that the request has one
dynamodb() {
  curl -sf http://localhost:8000 -H "X-Amz-Target: DynamoDB_20120810.$1" -H 'Content-Type: application/x-amz-json-1.0' \
    -H 'Authorization: AWS4-HMAC-SHA256 Credential=local/20260101/eu-west-3/dynamodb/aws4_request, SignedHeaders=host, Signature=local' \
    -d "$2"
}
dynamodb CreateTable '{"TableName":"city-stations","BillingMode":"PAY_PER_REQUEST",
  "AttributeDefinitions":[{"AttributeName":"pair","AttributeType":"S"}],
  "KeySchema":[{"AttributeName":"pair","KeyType":"HASH"}]}' > /dev/null

docker run -d --name lambda -p 9000:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e "MOTIS_BASE_URL=http://host.docker.internal:$MOCK_MOTIS_PORT/" \
  -e MOTIS_CITY_STATIONS_TABLE=city-stations \
  -e AWS_REGION=eu-west-3 -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local \
  -e AWS_ENDPOINT_URL_DYNAMODB=http://host.docker.internal:8000 \
  -v "$bootstrap:/var/runtime/bootstrap:ro" \
  public.ecr.aws/lambda/provided:al2023 bootstrap
sleep 3

invoke() {
  jq -n --arg body "$1" '{version: "2.0", rawPath: "/mcp", rawQueryString: "",
    headers: {host: "localhost", "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25"},
    requestContext: {http: {method: "POST", path: "/mcp"}}, body: $body, isBase64Encoded: false}' |
    curl -sf --data-binary @- http://localhost:9000/2015-03-31/functions/function/invocations
}

invoke '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' |
  jq -e '.statusCode == 200 and (.body | fromjson | .result.tools | map(.name) | index("plan_journey"))'
invoke '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"ui://motis/explorer.html"}}' |
  jq -e '.statusCode == 200 and (.body | fromjson | .result.contents[0].text | contains("<html"))'

# journeys between cities: discovery of the stations kept in DynamoDB, then from station to station, read from it
journey='{"jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"plan_journey","arguments":{"from":"Paris","to":"Nantes","time":"2026-11-04T08:00:00Z"}}}'
invoke "$journey" | jq -e '.statusCode == 200 and (.body | fromjson | .result.isError | not)'
dynamodb Scan '{"TableName":"city-stations"}' | jq -e '.Count == 1 and (.Items[0].from.L | length == 2)'
invoke "$journey" | jq -e '.statusCode == 200 and (.body | fromjson | .result.structuredContent.nextPageCursor | startswith("stations:"))'
