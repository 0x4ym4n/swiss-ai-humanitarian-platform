#!/usr/bin/env python3

import os
import sys
import requests
import json

# Add the Django project path so we can import the module
sys.path.insert(0, '/Users/ayman/Downloads/swiss-ai/django')

# Set up minimal Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vectorstore.settings')

try:
    import django
    django.setup()

    # Now import our HuggingFace module
    from vectorstore.llm.huggingface import call_huggingface

    print("Testing HuggingFace API...")

    # Test with a simple question
    test_content = "What is the capital of France?"

    print("Sending request: '{}'".format(test_content))
    response = call_huggingface(test_content, stream=False)

    print("SUCCESS!")
    print("Response: {}".format(response))

except Exception as e:
    print("Error: {}".format(e))
    import traceback
    traceback.print_exc()