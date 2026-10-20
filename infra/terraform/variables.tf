variable "region" {
  description = "AWS region. eu-west-1 (Ireland) or af-south-1 (Cape Town, must be opted in) are closest to Nigeria."
  type        = string
  default     = "eu-west-1"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "image_tag" {
  description = "Docker image tag to deploy (CI sets this to the git SHA)."
  type        = string
  default     = "latest"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "anthropic_api_key" {
  description = "Claude API key. Leave empty to run in extractive (no-LLM) mode."
  type        = string
  default     = ""
  sensitive   = true
}

variable "answer_model" {
  type    = string
  default = "claude-sonnet-5-5"
}

variable "monitor_every_hours" {
  type    = number
  default = 3
}

variable "smtp_host" {
  type    = string
  default = ""
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_pass" {
  type      = string
  default   = ""
  sensitive = true
}

variable "mail_from" {
  type    = string
  default = "RegRadar <alerts@example.com>"
}

variable "smtp_port" {
  type    = number
  default = 587
}

# Free alternatives to Claude for written answers: "gemini", "groq" (or leave "" to use
# anthropic_api_key, or neither for extractive mode).
variable "llm_provider" {
  type    = string
  default = ""
}

variable "llm_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "llm_model" {
  type    = string
  default = ""
}

# Google reCAPTCHA v2 ("I'm not a robot" checkbox). Add your CloudFront/custom domain to the
# key's allowed domains at https://www.google.com/recaptcha/admin. Leave both "" to switch it off.
variable "recaptcha_site_key" {
  type    = string
  default = ""
}

variable "recaptcha_secret_key" {
  type      = string
  default   = ""
  sensitive = true
}
