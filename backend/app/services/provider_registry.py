from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ProviderDefinition:
    slug: str
    label: str
    auth_types: tuple[str, ...]
    supports_direct_publish: bool
    supports_scheduled_publish: bool
    oauth_strategy: str | None = None
    supported_content_types: tuple[str, ...] = ()

    def to_public_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["auth_types"] = list(self.auth_types)
        payload["supported_content_types"] = list(self.supported_content_types)
        return payload


PROVIDERS: dict[str, ProviderDefinition] = {
    "linkedin": ProviderDefinition(
        slug="linkedin",
        label="LinkedIn",
        auth_types=("oauth2", "manual_token"),
        supports_direct_publish=True,
        supports_scheduled_publish=True,
        oauth_strategy="linkedin_oauth",
        supported_content_types=("text", "article", "image", "video"),
    ),
    "twitter": ProviderDefinition(
        slug="twitter",
        label="X / Twitter",
        auth_types=("oauth2", "oauth1a", "manual_token"),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
    "instagram": ProviderDefinition(
        slug="instagram",
        label="Instagram",
        auth_types=("oauth2", "manual_token"),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
    "facebook": ProviderDefinition(
        slug="facebook",
        label="Facebook",
        auth_types=("oauth2", "manual_token"),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
    "wordpress": ProviderDefinition(
        slug="wordpress",
        label="WordPress",
        auth_types=("oauth2", "api_key", "basic", "manual_token"),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
    "ghost": ProviderDefinition(
        slug="ghost",
        label="Ghost",
        auth_types=("api_key", "manual_token"),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
    "substack": ProviderDefinition(
        slug="substack",
        label="Substack",
        auth_types=("manual_token",),
        supports_direct_publish=False,
        supports_scheduled_publish=False,
    ),
}


def get_provider_definition(provider: str) -> ProviderDefinition:
    try:
        return PROVIDERS[provider]
    except KeyError as exc:
        raise ValueError(f"Unsupported provider '{provider}'.") from exc


def list_provider_definitions() -> list[ProviderDefinition]:
    return list(PROVIDERS.values())