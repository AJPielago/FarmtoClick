"""
API Blueprint package – ``routes.api``

The single ``api_bp`` blueprint is created here and every sub-module
registers its routes on it.  ``app.py`` only needs::

    from routes.api import api_bp
    app.register_blueprint(api_bp)
"""

from flask import Blueprint

api_bp = Blueprint('api', __name__, url_prefix='/api')

# Import sub-modules so their route decorators execute against ``api_bp``.
# The import order does not matter because there are no inter-module route
# dependencies, but we list them alphabetically for clarity.
from . import auth      # noqa: F401, E402
from . import cart      # noqa: F401, E402
from . import dti       # noqa: F401, E402
from . import farmer    # noqa: F401, E402
from . import orders    # noqa: F401, E402
from . import payments  # noqa: F401, E402
from . import products  # noqa: F401, E402
from . import profile   # noqa: F401, E402
from . import rider     # noqa: F401, E402
