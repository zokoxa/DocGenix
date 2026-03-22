import os
from fetchai.communication import send_message_to_agent
from uagents.crypto import Identity
# 1. Setup credentials and identities
AGENTVERSE_KEY = "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE3NzY3MzAwNjcsImlhdCI6MTc3NDEzODA2NywiaXNzIjoiZmV0Y2guYWkiLCJqdGkiOiIyZTVhMTk3NjM2ZTlmZDdiZTNhMDkzZTYiLCJzY29wZSI6ImF2Iiwic3ViIjoiNWNkODRmOTZjNjU1NzZmMGM4MzIwNDRiNGFkMzRiNGM4NzRmYzE5ZjAxNzBlMWM0In0.PWlpwxK_cg298i382Eq8AH_hcyL7OSyesuE1Iej4tU-0XUGh5VnFGXleeKjLpW-WEVaGDki61zgr1C6Nru8azKpMSzNrD0nxH4MZlBi2CQGpaz6uUBGR8OO_zFuoRIW3RrJMYg6o2IdqIlkS139ze2Z23VrGBanG60Xet2LsuSleGGgvOLz9waqvob9cMihUZndgCqCzUdX_h8gk77u1BIGlvAcpQLxrEGeIPK8nqMcJr-4TWtN-0F_SOLwXGTNx1RhiwcnuFWckg7LV9proPgTOnACJhx-vo-92zYr08AKw9CkH5W4vWjq5n-DOnzYTKLwZZpuwrmKH4Mdoi2yiQQ"
# Generate a sender identity from a seed phrase
sender_identity = Identity.from_seed("9999", 0)

# 2. Define the target agent address from Agentverse
TARGET_AGENT_ADDRESS = "agent1qvjnlkmpjzcfc5le5am0vfydzxjagww2y3f56um6rquejvuhzeny2pkecks" 
                        
# 3. Call the agent
def call_agent():
    response = send_message_to_agent(
        sender=sender_identity,
        target=TARGET_AGENT_ADDRESS,
        payload={"content": [{"text": "Hello, say hi to @dm1n"}]}    
        )
    print(f"Message sent! Response: {response}")

if __name__ == "__main__":
    call_agent()