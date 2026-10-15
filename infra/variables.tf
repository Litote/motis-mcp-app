variable "aws_region" {
  description = "AWS region of the Lambda."
  type        = string
  default     = "eu-west-3"
}

variable "name" {
  description = "Name of the Lambda function and prefix of the related resources."
  type        = string
  default     = "motis-mcp-app"
}

variable "lambda_zip" {
  description = "Lambda package built by `make build` (native executable `bootstrap`)."
  type        = string
  default     = "../lambda/build/libs/lambda.zip"
}

variable "motis_app_contact" {
  description = "E-mail address or website URL sent in the User-Agent: required by the Transitous usage policy."
  type        = string

  validation {
    condition     = length(trimspace(var.motis_app_contact)) > 0
    error_message = "motis_app_contact is required (Transitous usage policy)."
  }
}

variable "motis_base_url" {
  description = "MOTIS 2 API."
  type        = string
  default     = "https://api.transitous.org/"
}

variable "motis_log_level" {
  description = "Ktor client log level: NONE, INFO, HEADERS, BODY, ALL."
  type        = string
  default     = "NONE"
}

variable "tile_url" {
  description = "Raster tiles of the maps (Leaflet URL template). Empty: OpenStreetMap, whose tile usage policy forbids an intensive use."
  type        = string
  default     = ""
}

variable "tile_attribution" {
  description = "Attribution of the tiles (HTML). Empty: OpenStreetMap contributors."
  type        = string
  default     = ""
}

variable "view_domains" {
  description = "Dedicated origin of the views (_meta.ui.domain, format defined by each host) on the endpoint /mcp/<host> of a host: chatgpt, claude (default: computed from the endpoint URL), mistral, cherry. E.g. to allowlist it at the tile provider."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for host in keys(var.view_domains) : contains(["chatgpt", "claude", "mistral", "cherry"], host)])
    error_message = "view_domains keys must be chatgpt, claude, mistral or cherry."
  }
}

variable "architecture" {
  description = "Lambda architecture, matching the native executable: arm64 (CI build on an arm64 runner) or x86_64. `make` passes the host's."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.architecture)
    error_message = "architecture must be arm64 or x86_64."
  }
}

variable "memory_mb" {
  description = "Memory of the Lambda (the CPU is proportional)."
  type        = number
  default     = 512
}

variable "timeout_seconds" {
  description = "Timeout of an invocation: the tools wait for MOTIS (journey planning, isochrones)."
  type        = number
  default     = 60
}

variable "reserved_concurrency" {
  description = "Max concurrent executions, bounding the load on MOTIS and the cost. -1: no reservation (account limit)."
  type        = number
  default     = 10
}

variable "cors_allow_origins" {
  description = "Origins allowed by CORS (browser-based MCP clients and inspectors)."
  type        = list(string)
  default     = ["*"]
}

variable "log_retention_days" {
  description = "Retention of the CloudWatch logs."
  type        = number
  default     = 14
}

variable "web_price_class" {
  description = "CloudFront price class of the web chat distributions (PriceClass_100: North America and Europe)."
  type        = string
  default     = "PriceClass_100"
}
