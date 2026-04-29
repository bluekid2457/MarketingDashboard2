import json
from threading import Lock

import firebase_admin
from firebase_admin import credentials, firestore

from app.config import settings

_app_lock = Lock()
_firestore_client = None


def _build_credentials():
    if settings.firebase_service_account_json:
        return credentials.Certificate(json.loads(settings.firebase_service_account_json))

    if settings.firebase_credentials_path:
        return credentials.Certificate(settings.firebase_credentials_path)

    if settings.firebase_client_email and settings.firebase_private_key and settings.firebase_project_id:
        return credentials.Certificate(
            {
                "type": "service_account",
                "project_id": settings.firebase_project_id,
                "client_email": settings.firebase_client_email,
                "private_key": settings.firebase_private_key.replace("\\n", "\n"),
                "token_uri": "https://oauth2.googleapis.com/token",
            },
        )

    return None


def get_firestore_client():
    global _firestore_client

    if _firestore_client is not None:
        return _firestore_client

    with _app_lock:
        if _firestore_client is not None:
            return _firestore_client

        firebase_app = firebase_admin.get_app() if firebase_admin.get_apps() else None
        if firebase_app is None:
            credential = _build_credentials()
            options = {}
            if settings.firebase_project_id:
                options["projectId"] = settings.firebase_project_id
            firebase_app = firebase_admin.initialize_app(credential=credential, options=options or None)

        _firestore_client = firestore.client(firebase_app)
        return _firestore_client